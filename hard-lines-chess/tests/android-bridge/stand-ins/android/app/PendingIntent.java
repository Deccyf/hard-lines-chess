package android.app;
import android.content.Context;
import android.content.Intent;
/** What it would do when fired, and the flags it was made with. */
public final class PendingIntent {
    public static final int FLAG_IMMUTABLE = 1 << 26;
    public static final int FLAG_UPDATE_CURRENT = 1 << 27;
    public final String kind;
    public final Intent intent;
    public final int flags;
    private PendingIntent(String kind, Intent intent, int flags) { this.kind = kind; this.intent = intent; this.flags = flags; }
    public static PendingIntent getBroadcast(Context context, int requestCode, Intent intent, int flags) { return new PendingIntent("broadcast", intent, flags); }
    public static PendingIntent getActivity(Context context, int requestCode, Intent intent, int flags) { return new PendingIntent("activity", intent, flags); }
}
