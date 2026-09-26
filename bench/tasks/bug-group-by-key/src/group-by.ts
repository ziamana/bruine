export interface User {
  name: string;
  role: string;
}

/** Users per role. */
export function groupBy(users: User[], key: (user: User) => string): Record<string, User[]> {
  const out: Record<string, User[]> = {};
  for (const user of users) out[key(user)] = [];
  return out;
}
