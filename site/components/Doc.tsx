import type { ReactNode } from "react";

export interface DocSection {
  id: string;
  title: string;
  body: ReactNode;
}

/** A reading page: the sections listed on the side, one column of prose. */
export function Doc({ title, lead, sections, tocLabel }: { title: string; lead: ReactNode; sections: DocSection[]; tocLabel: string }) {
  return (
    <main className="doc">
      <nav className="doc-toc" aria-label={tocLabel}>
        <ol>
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      <article className="prose">
        <h1>{title}</h1>
        <p className="prose-lead">{lead}</p>
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={s.id}>
            <h2 id={s.id}>{s.title}</h2>
            {s.body}
          </section>
        ))}
      </article>
    </main>
  );
}

export function Table({ head, rows, className }: { head: ReactNode[]; rows: ReactNode[][]; className?: string }) {
  return (
    <div className="table-wrap">
      <table className={className}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
