package android.content.pm;
public class PackageManager {
    public static final int PERMISSION_GRANTED = 0;
    public static final int PERMISSION_DENIED = -1;
    public static class NameNotFoundException extends Exception {}
    /** What the phone knows about an app. The test says what that is, in Context. */
    public PackageInfo getPackageInfo(String name, int flags) throws NameNotFoundException {
        if (!android.content.Context.packageKnown || !android.content.Context.PACKAGE.equals(name)) throw new NameNotFoundException();
        PackageInfo info = new PackageInfo();
        info.firstInstallTime = android.content.Context.firstInstallTime;
        info.lastUpdateTime = android.content.Context.lastUpdateTime;
        return info;
    }
}
