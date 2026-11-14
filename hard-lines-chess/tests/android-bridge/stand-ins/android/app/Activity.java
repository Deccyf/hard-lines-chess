package android.app;
import android.os.Bundle;
public class Activity extends android.content.Context {
    protected void onCreate(Bundle b) {}
    protected void onPause() {}
    protected void onResume() {}
    protected void onDestroy() {}
    protected void onSaveInstanceState(Bundle b) {}
    public void onConfigurationChanged(android.content.res.Configuration c) {}
    public android.view.Window getWindow() { return new android.view.Window(); }
    public void setContentView(android.view.View v) {}
    /** The test has one thread standing in for the main one, so this runs it there and then. */
    public final void runOnUiThread(Runnable r) { synchronized (Activity.class) { r.run(); } }
    public void finish() {}
}
