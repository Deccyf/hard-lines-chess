package chess.hardlines;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * What Android calls when the reminder's alarm rings — and when the phone has
 * restarted or the app has been updated, both of which clear every alarm an
 * app has set. Those two set it again; anything else is the alarm itself.
 *
 * It is not exported: the alarm is the app's own, and the two announcements
 * come from the system, which may reach a receiver that nothing else can.
 */
public final class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Reminder.schedule(context);
            return;
        }
        Reminder.ring(context);
    }
}
