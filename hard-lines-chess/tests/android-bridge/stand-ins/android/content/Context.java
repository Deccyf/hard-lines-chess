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
    public int getColor(int id) { return 0; }
    public android.content.res.AssetManager getAssets() { return new android.content.res.AssetManager(); }
    public android.content.res.Resources getResources() { return new android.content.res.Resources(); }
    public ContentResolver getContentResolver() { return resolver; }
}
