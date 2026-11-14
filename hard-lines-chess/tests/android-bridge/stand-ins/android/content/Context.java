package android.content;
public class Context {
    /** Where the app's own files are. Set by the test, and the same from one start of the app to the next. */
    public static java.io.File filesDir = null;
    private final ContentResolver resolver = new ContentResolver();
    public java.io.File getFilesDir() {
        if (filesDir == null) throw new IllegalStateException("the test has not said where the app's files are");
        return filesDir;
    }
    /** Where the app keeps what is only passing through. The phone may clear it; so may the test. */
    public static java.io.File cacheDir = null;
    public java.io.File getCacheDir() {
        if (cacheDir == null) throw new IllegalStateException("the test has not said where the app's cache is");
        return cacheDir;
    }
    public static final int MODE_PRIVATE = 0;
    /** The small stores, by name. They belong to the app, not to one start of it. */
    public static final java.util.Map<String, SharedPreferences> stores = new java.util.HashMap<>();
    public SharedPreferences getSharedPreferences(String name, int mode) {
        if (mode != MODE_PRIVATE) throw new IllegalArgumentException("a store other apps could read");
        return stores.computeIfAbsent(name, (n) -> new SharedPreferences());
    }
    /** What the person has allowed. */
    public static final java.util.Set<String> granted = new java.util.HashSet<>();
    public int checkSelfPermission(String permission) {
        return granted.contains(permission) ? android.content.pm.PackageManager.PERMISSION_GRANTED : android.content.pm.PackageManager.PERMISSION_DENIED;
    }
    @SuppressWarnings("unchecked")
    public <T> T getSystemService(Class<T> service) {
        if (service == android.app.AlarmManager.class) return (T) android.app.AlarmManager.only;
        if (service == android.app.NotificationManager.class) return (T) android.app.NotificationManager.only;
        return null;
    }
    public int getColor(int id) { return 0; }
    public android.content.res.AssetManager getAssets() { return new android.content.res.AssetManager(); }
    public android.content.res.Resources getResources() { return new android.content.res.Resources(); }
    public ContentResolver getContentResolver() { return resolver; }
}
