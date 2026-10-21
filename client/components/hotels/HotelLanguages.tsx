import { Languages } from "lucide-react";

interface HotelLanguagesProps {
  heading: string;
  /** Already named in the visitor's language — see `staffLanguages`. */
  languages: { code: string; name: string }[];
  /** 2 when the block stands alone, 3 when it sits under the Facilities heading. */
  level?: 2 | 3;
}

/**
 * The languages the staff speak.
 *
 * A block of its own rather than rows in the facilities grid: it describes the
 * people on the desk, not the building, and it must not make an otherwise
 * empty Facilities section look populated.
 *
 * Not a `Badge`: those set `uppercase`, which turns Georgian into Mtavruli
 * capitals and shouts a list that is only information.
 */
export function HotelLanguages({ heading, languages, level = 3 }: HotelLanguagesProps) {
  if (languages.length === 0) return null;

  const Heading = level === 2 ? "h2" : "h3";

  return (
    <div>
      <Heading className={level === 2 ? "type-h2" : "type-h4 flex items-center gap-2.5"}>
        {level === 3 && <Languages size={18} className="shrink-0 text-brand-text" aria-hidden />}
        {heading}
      </Heading>
      <ul className={level === 2 ? "mt-8 flex flex-wrap gap-2" : "mt-4 flex flex-wrap gap-2"}>
        {languages.map((language) => (
          <li
            key={language.code}
            className="type-body-sm rounded-sm bg-surface-soft px-3 py-1.5 text-body"
          >
            {language.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
