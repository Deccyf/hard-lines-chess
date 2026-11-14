package org.json;
public class JSONObject {
    /** As the real one: the text as a JSON string, quotes and all. */
    public static String quote(String s) {
        if (s == null || s.isEmpty()) return "\"\"";
        StringBuilder out = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                default: if (c < 0x20) out.append(String.format("\\u%04x", (int) c)); else out.append(c);
            }
        }
        return out.append('"').toString();
    }
}
