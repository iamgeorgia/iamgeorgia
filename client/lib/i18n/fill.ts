/**
 * Fills `{placeholder}` slots in a dictionary string.
 *
 *   fill("{count} reviews", { count: 128 }) → "128 reviews"
 *
 * Deliberately tiny — the alternative is pulling in an ICU message formatter
 * for a handful of single-value substitutions.
 *
 * In its own module so that Client Components can import it without touching
 * `dictionaries.ts`, which holds all four dictionaries. Tree-shaking keeps
 * those out of the browser bundle today; a module boundary keeps them out on
 * purpose.
 */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
