package android.webkit;
import java.io.InputStream;
import java.util.Map;
/** An answer given from inside the app, remembered so that a test can read it. */
public class WebResourceResponse {
    public final String mime;
    public final int status;
    private Map<String, String> headers;
    public WebResourceResponse(String mime, String enc, InputStream data) { this(mime, enc, 200, "OK", null, data); }
    public WebResourceResponse(String mime, String enc, int status, String reason, Map<String, String> headers, InputStream data) {
        this.mime = mime;
        this.status = status;
        this.headers = headers;
    }
    public int getStatusCode() { return status; }
    public Map<String, String> getResponseHeaders() { return headers; }
    public void setResponseHeaders(Map<String, String> headers) { this.headers = headers; }
}
