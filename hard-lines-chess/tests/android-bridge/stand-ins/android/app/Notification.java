package android.app;
import android.content.Context;
/** A notification, as far as the test needs to read one back. */
public class Notification {
    public String channel;
    public int icon;
    public CharSequence title;
    public CharSequence text;
    public PendingIntent tap;
    public boolean autoCancel;
    public static class Builder {
        private final Notification n = new Notification();
        public Builder(Context context, String channelId) { n.channel = channelId; }
        public Builder setSmallIcon(int icon) { n.icon = icon; return this; }
        public Builder setContentTitle(CharSequence title) { n.title = title; return this; }
        public Builder setContentText(CharSequence text) { n.text = text; return this; }
        public Builder setContentIntent(PendingIntent intent) { n.tap = intent; return this; }
        public Builder setAutoCancel(boolean autoCancel) { n.autoCancel = autoCancel; return this; }
        public Notification build() { return n; }
    }
}
