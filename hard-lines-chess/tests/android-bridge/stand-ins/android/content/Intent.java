package android.content;
public class Intent {
    public static final String ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED";
    public static final String ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED";
    public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
    public static final int FLAG_ACTIVITY_CLEAR_TOP = 0x04000000;
    public Class<?> target = null;
    public String action = null;
    public int flags = 0;
    public Intent() {}
    public Intent(String action) { this.action = action; }
    public Intent(Context packageContext, Class<?> cls) { this.target = cls; }
    public String getAction() { return action; }
    public Intent setFlags(int flags) { this.flags = flags; return this; }
}
