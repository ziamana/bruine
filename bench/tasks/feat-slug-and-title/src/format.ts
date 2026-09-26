/** A published article. */
export interface Article {
  title: string;
  body: string;
}

export function formatTitle(article: Article): string {
  return article.title;
}
