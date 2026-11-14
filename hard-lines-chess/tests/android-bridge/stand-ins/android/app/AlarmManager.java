package android.app;
import java.util.*;
/** Remembers the one alarm it was asked to keep, and how often it was asked to forget one. */
public class AlarmManager {
    public static final int RTC_WAKEUP = 0;
    public static final long INTERVAL_DAY = 86400000L;
    /** One for the whole test, as a phone has one; the test clears it between cases. */
    public static final AlarmManager only = new AlarmManager();
    public PendingIntent set = null;
    public int type = -1;
    public long at = 0L;
    public long every = 0L;
    public int cancelled = 0;
    public void setInexactRepeating(int type, long triggerAtMillis, long intervalMillis, PendingIntent operation) {
        this.type = type; this.at = triggerAtMillis; this.every = intervalMillis; this.set = operation;
    }
    public void cancel(PendingIntent operation) { cancelled++; set = null; }
    public void reset() { set = null; type = -1; at = 0L; every = 0L; cancelled = 0; }
}
