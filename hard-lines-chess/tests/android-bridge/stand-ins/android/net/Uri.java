package android.net;
/** An address. Told apart by which one it is, not by how it is spelt: two made from the same text are two. */
public class Uri {
    private final String text;
    private final java.net.URI parsed;
    public Uri(String text) {
        this.text = text;
        java.net.URI made = null;
        try { made = new java.net.URI(text); } catch (java.net.URISyntaxException notOne) { made = null; }
        this.parsed = made;
    }
    public static Uri parse(String text) { return new Uri(text); }
    public String getScheme() { return parsed == null ? null : parsed.getScheme(); }
    public String getHost() { return parsed == null ? null : parsed.getHost(); }
    public int getPort() { return parsed == null ? -1 : parsed.getPort(); }
    public String getPath() { return parsed == null ? text : parsed.getPath(); }
    @Override public String toString() { return text; }
}
