package android.provider;
public class DocumentsContract {
    public static boolean deleteDocument(android.content.ContentResolver r, android.net.Uri u) throws java.io.FileNotFoundException {
        r.deleted.add(u);
        r.written.remove(u);
        return true;
    }
}
