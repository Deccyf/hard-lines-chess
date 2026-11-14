package androidx.webkit;
import android.net.Uri;
import android.webkit.WebResourceResponse;
/** Answers for anything under a path it was given, on the name it was given, and for nothing else. */
public final class WebViewAssetLoader {
    public interface PathHandler {}
    public static final class AssetsPathHandler implements PathHandler { public AssetsPathHandler(android.content.Context c) {} }
    public static final class Builder {
        private String domain = "appassets.androidplatform.net";
        private String path = null;
        public Builder setDomain(String d) { domain = d; return this; }
        public Builder addPathHandler(String p, PathHandler h) { path = p; return this; }
        public WebViewAssetLoader build() { return new WebViewAssetLoader(domain, path); }
    }
    private final String domain;
    private final String path;
    private WebViewAssetLoader(String domain, String path) { this.domain = domain; this.path = path; }
    public WebResourceResponse shouldInterceptRequest(Uri u) {
        if (path == null || !"https".equals(u.getScheme()) || !domain.equalsIgnoreCase(u.getHost())) return null;
        if (u.getPath() == null || !u.getPath().startsWith(path)) return null;
        return new WebResourceResponse("text/html", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
    }
}
