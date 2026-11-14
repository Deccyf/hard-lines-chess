package android.net;
public class Uri {
    private final String text;
    public Uri(String text) { this.text = text; }
    public String getHost() { return null; }
    public String getPath() { return text; }
    @Override public String toString() { return text; }
}
