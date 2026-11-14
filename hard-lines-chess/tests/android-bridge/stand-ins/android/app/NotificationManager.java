package android.app;
import java.util.*;
/** Remembers what it was asked to show and to take down, and can be told the person has turned notifications off. */
public class NotificationManager {
    public static final int IMPORTANCE_DEFAULT = 3;
    /** One for the whole test, as a phone has one; the test clears it between cases. */
    public static final NotificationManager only = new NotificationManager();
    public boolean enabled = true;
    public final List<NotificationChannel> channels = new ArrayList<>();
    public final Map<Integer, Notification> showing = new HashMap<>();
    public int posted = 0;
    public int takenDown = 0;
    public boolean areNotificationsEnabled() { return enabled; }
    public void createNotificationChannel(NotificationChannel channel) { channels.add(channel); }
    public void notify(int id, Notification notification) {
        if (channels.stream().noneMatch((c) -> c.id.equals(notification.channel))) throw new IllegalStateException("posted on a channel that was never made");
        posted++; showing.put(id, notification);
    }
    public void cancel(int id) { takenDown++; showing.remove(id); }
    public void reset() { enabled = true; channels.clear(); showing.clear(); posted = 0; takenDown = 0; }
}
