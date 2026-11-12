import type { CurrentUser } from "./auth";
import { getUser } from "./users";

/** Resolve the employee's read scope without changing the signed-in actor. */
export async function employeeWorkPerspective(user: CurrentUser, employee?: string | null): Promise<CurrentUser | null> {
  const email = employee?.trim().toLowerCase();
  // An employee URL (including an admin in employee mode) cannot widen access.
  if (!user.isAdmin || !email || email === user.email) return user;
  const person = await getUser(email);
  if (!person?.active) return null;
  return { email: person.email, name: person.name, isAdmin: false };
}
