package androidx.webkit;
import android.net.Uri;
import android.webkit.WebResourceResponse;
public final class WebViewAssetLoader {
    public interface PathHandler {}
    public static final class AssetsPathHandler implements PathHandler { public AssetsPathHandler(android.content.Context c) {} }
    public static final class Builder { public Builder setDomain(String d) { return this; } public Builder addPathHandler(String p, PathHandler h) { return this; } public WebViewAssetLoader build() { return new WebViewAssetLoader(); } }
    public WebResourceResponse shouldInterceptRequest(Uri u) { return null; }
}
