package androidx.activity.result.contract;
import android.net.Uri;
public final class ActivityResultContracts {
    public static class CreateDocument extends ActivityResultContract<String, Uri> { public final String mimeType; public CreateDocument(String mimeType) { this.mimeType = mimeType; } }
    public static class OpenDocument extends ActivityResultContract<String[], Uri> { public OpenDocument() {} }
}
