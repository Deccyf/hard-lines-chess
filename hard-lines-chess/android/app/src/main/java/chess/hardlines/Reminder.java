package chess.hardlines;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * The daily reminder: once a day, at a time that was picked, a notification
 * that today's session has not been done — and none on a day when it has.
 *
 * IT IS OFF UNTIL IT IS TURNED ON, in the app, beside the session it is about.
 * Turning it on is the moment Android is asked whether the app may show
 * notifications at all; until then the app holds that permission in its
 * manifest and has never used it.
 *
 * THE PAGE KNOWS ABOUT SESSIONS; THIS KNOWS ABOUT CLOCKS. The page says when a
 * session is finished, on which day, and how long the run of days then is.
 * That is kept here, outside the page, because the reminder fires when the
 * page is not running — which is the point of it.
 *
 * ABOUT THE TIME, NOT ON IT. Android is asked for a repeating alarm it may
 * move by some minutes to save the battery; an exact one needs a permission
 * of its own, and "about six" is all a reminder has to be.
 *
 * AN ALARM DOES NOT SURVIVE THE PHONE RESTARTING, NOR THE APP BEING UPDATED.
 * ReminderReceiver hears both and sets it again.
 *
 * The parts that are only arithmetic — which day a moment is, when the alarm
 * should next ring, what the notification says — take everything they need
 * as arguments, so tests/android-bridge can run them on an ordinary JVM.
 */
final class Reminder {
    private static final String STORE = "reminder";
    private static final String CHANNEL = "daily-session";
    private static final int NOTIFICATION = 1;
    static final String MAY_NOTIFY = "android.permission.POST_NOTIFICATIONS";

    private Reminder() {}

    // ── clocks and days ────────────────────────────────────────────────────

    /** The day a moment falls on by this phone's calendar, written as the page writes it: 2026-11-14. */
    static String dayOf(long at, TimeZone zone) {
        Calendar c = Calendar.getInstance(zone, Locale.ROOT);
        c.setTimeInMillis(at);
        return String.format(Locale.ROOT, "%04d-%02d-%02d",
                c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    /** The day before a day, or an empty string for something that is not a day. */
    static String dayBefore(String day) {
        String[] parts = day == null ? new String[0] : day.split("-");
        if (parts.length != 3) return "";
        try {
            // Noon, in a zone with no clock changes: the answer is a date, and
            // must not depend on where the phone is.
            Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
            c.clear();
            c.set(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]) - 1, Integer.parseInt(parts[2]), 12, 0, 0);
            c.add(Calendar.DAY_OF_MONTH, -1);
            return dayOf(c.getTimeInMillis(), TimeZone.getTimeZone("UTC"));
        } catch (NumberFormatException e) {
            return "";
        }
    }

    /** The next moment the clock says hour:minute, after now: later today, or tomorrow. */
    static long nextAt(long now, int hour, int minute, TimeZone zone) {
        Calendar c = Calendar.getInstance(zone, Locale.ROOT);
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, hour);
        c.set(Calendar.MINUTE, minute);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= now) c.add(Calendar.DAY_OF_MONTH, 1);
        return c.getTimeInMillis();
    }

    /**
     * What the reminder says today — or null, which means say nothing: today's
     * session is already done.
     *
     * A run is only mentioned while it is alive, which is when the last
     * session finished was yesterday's. The page steps over days on which
     * there was nothing to do; this does not know about those, so after one it
     * says the plain sentence rather than risk a number that is wrong.
     */
    static String words(String today, String doneDay, int run) {
        if (today.equals(doneDay)) return null;
        if (run > 0 && dayBefore(today).equals(doneDay)) {
            return run == 1
                    ? "One day done. Today's session makes it two."
                    : run + " days running. Today's session keeps it going.";
        }
        return "A few of your own mistakes, and puzzles for what your games go wrong in.";
    }

    // ── what is kept ───────────────────────────────────────────────────────

    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    static boolean isOn(Context context) { return store(context).getBoolean("on", false); }
    static int hour(Context context) { return store(context).getInt("hour", 18); }
    static int minute(Context context) { return store(context).getInt("minute", 0); }

    /** Turn the reminder on at a time, or off, and set or clear the alarm to match. */
    static void set(Context context, boolean on, int hour, int minute) {
        store(context).edit()
                .putBoolean("on", on)
                .putInt("hour", Math.max(0, Math.min(23, hour)))
                .putInt("minute", Math.max(0, Math.min(59, minute)))
                .apply();
        schedule(context);
    }

    /** The page says a session was finished: on which day, and how long the run then was. */
    static void done(Context context, String day, int run) {
        store(context).edit()
                .putString("doneDay", day == null ? "" : day)
                .putInt("run", Math.max(0, run))
                .apply();
        // A reminder still showing for a session that has now been done is
        // taken down rather than left to be tapped.
        if (words(dayOf(System.currentTimeMillis(), TimeZone.getDefault()), day == null ? "" : day, run) == null) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            if (manager != null) manager.cancel(NOTIFICATION);
        }
    }

    // ── the alarm ──────────────────────────────────────────────────────────

    private static PendingIntent alarm(Context context) {
        return PendingIntent.getBroadcast(context, 0, new Intent(context, ReminderReceiver.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Set the alarm for the time that is kept, or clear it when the reminder is off. */
    static void schedule(Context context) {
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (alarms == null) return;
        PendingIntent ring = alarm(context);
        alarms.cancel(ring);
        if (!isOn(context)) return;
        alarms.setInexactRepeating(AlarmManager.RTC_WAKEUP,
                nextAt(System.currentTimeMillis(), hour(context), minute(context), TimeZone.getDefault()),
                AlarmManager.INTERVAL_DAY, ring);
    }

    // ── the notification ───────────────────────────────────────────────────

    /** Whether Android will show a notification from this app if one is posted. */
    static boolean allowed(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        return Build.VERSION.SDK_INT < 33
                || context.checkSelfPermission(MAY_NOTIFY) == PackageManager.PERMISSION_GRANTED;
    }

    /** The alarm has rung: say so, unless it is off, not allowed, or today's is done. */
    static void ring(Context context) {
        if (!isOn(context) || !allowed(context)) return;
        SharedPreferences kept = store(context);
        String text = words(dayOf(System.currentTimeMillis(), TimeZone.getDefault()),
                kept.getString("doneDay", ""), kept.getInt("run", 0));
        if (text == null) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        // Making a channel that is already there changes nothing, so it is
        // made every time rather than remembered.
        manager.createNotificationChannel(
                new NotificationChannel(CHANNEL, "Daily session", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.notify(NOTIFICATION, new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_session)
                .setContentTitle("Today's session")
                .setContentText(text)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build());
    }
}
