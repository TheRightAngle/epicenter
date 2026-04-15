/**
 * Capitalize the first letter of a string.
 *
 * Used for deriving display names from plan IDs (e.g. "ultra" → "Ultra").
 *
 * @example
 * ```typescript
 * capitalize('ultra'); // "Ultra"
 * capitalize('free');  // "Free"
 * capitalize('');      // ""
 * ```
 */
export function capitalize(str: string): string {
	if (str.length === 0) return '';
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Derive display initials from a user's name or email.
 *
 * Takes first + last initials from a multi-word name, first two
 * characters from a single-word name, or first two characters
 * from an email address as fallback.
 *
 * @example
 * ```typescript
 * getInitials('Braden Wong', 'b@e.so');    // "BW"
 * getInitials('Braden', 'b@e.so');         // "BR"
 * getInitials('', 'braden@epicenter.so');   // "BR"
 * getInitials('', '');                      // ""
 * ```
 */
export function getInitials(name: string, email: string): string {
	if (name) {
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) {
			const first = parts[0]?.[0] ?? '';
			const last = parts[parts.length - 1]?.[0] ?? '';
			return (first + last).toUpperCase();
		}
		return name.slice(0, 2).toUpperCase();
	}
	return email.slice(0, 2).toUpperCase();
}
