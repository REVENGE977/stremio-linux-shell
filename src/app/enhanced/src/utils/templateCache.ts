export class TemplateCache {
    /**
     * Replaces placeholders formatted as {{ key }} with values from the data map.
     */
    public static render(template: string, data: Record<string, any>): string {
        let result = template;
        for (const [key, val] of Object.entries(data)) {
            const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
            result = result.replace(regex, val !== null && val !== undefined ? String(val) : '');
        }
        return result;
    }
}
