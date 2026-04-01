/**
 * Parse a tags field value into an array of strings.
 * Handles: null/undefined, arrays, JSON-encoded arrays, and plain strings.
 */
export function parseTagsValue(value: unknown): string[] {
	if (value == null) {return [];}
	if (Array.isArray(value)) {return value.map(String).filter(Boolean);}
	const str = String(value).trim();
	if (!str) {return [];}
	if (str.startsWith("[")) {
		try {
			const parsed = JSON.parse(str);
			if (Array.isArray(parsed)) {return parsed.map(String).filter(Boolean);}
		} catch { /* not JSON */ }
	}
	return [str];
}
