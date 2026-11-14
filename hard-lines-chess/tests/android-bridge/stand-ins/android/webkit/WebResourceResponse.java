package android.webkit;
import java.io.InputStream;
import java.util.Map;
public class WebResourceResponse { public WebResourceResponse(String mime, String enc, InputStream data) {} public WebResourceResponse(String mime, String enc, int status, String reason, Map<String, String> headers, InputStream data) {} }
