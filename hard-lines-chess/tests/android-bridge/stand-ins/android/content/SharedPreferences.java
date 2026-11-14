package android.content;
import java.util.*;
/** A small store that outlives the app being closed: here, a map that outlives the activity. */
public class SharedPreferences {
    final Map<String, Object> values = new HashMap<>();
    public boolean getBoolean(String key, boolean fallback) { Object v = values.get(key); return v instanceof Boolean ? (Boolean) v : fallback; }
    public int getInt(String key, int fallback) { Object v = values.get(key); return v instanceof Integer ? (Integer) v : fallback; }
    public String getString(String key, String fallback) { Object v = values.get(key); return v instanceof String ? (String) v : fallback; }
    public Editor edit() { return new Editor(); }
    public final class Editor {
        private final Map<String, Object> pending = new HashMap<>();
        public Editor putBoolean(String key, boolean value) { pending.put(key, value); return this; }
        public Editor putInt(String key, int value) { pending.put(key, value); return this; }
        public Editor putString(String key, String value) { pending.put(key, value); return this; }
        /** Nothing is kept until this is called, as on a phone. */
        public void apply() { values.putAll(pending); }
    }
}
