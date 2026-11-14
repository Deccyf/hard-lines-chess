package android.webkit;
import android.os.Bundle;
import java.util.*;
/** Remembers what was exposed to the page and what the app said to it. */
public class WebView extends android.view.ViewGroup {
    public final Map<String, Object> interfaces = new HashMap<>();
    public final List<String> said = Collections.synchronizedList(new ArrayList<>());
    public String loaded = null;
    private final WebSettings settings = new WebSettings();
    public WebView(android.content.Context c) {}
    public WebSettings getSettings() { return settings; }
    public WebViewClient client = null;
    public void setWebViewClient(WebViewClient c) { client = c; }
    public void addJavascriptInterface(Object o, String name) {
        if (loaded != null) throw new IllegalStateException("added after the page was loaded: the page would never see it");
        interfaces.put(name, o);
    }
    public void loadUrl(String u) { loaded = u; }
    public void evaluateJavascript(String s, ValueCallback<String> cb) { said.add(s); }
    public boolean canGoBack() { return false; }
    public void goBack() {}
    public Object restoreState(Bundle b) { return null; }
    public Object saveState(Bundle b) { return null; }
    public void onPause() {}
    public void onResume() {}
    public void pauseTimers() {}
    public void resumeTimers() {}
    public void destroy() {}
}
