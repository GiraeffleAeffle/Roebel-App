import { redirect } from "next/navigation";

/**
 * The citizen dashboard moved into its own shell at /arbeitsbereich, so
 * citizens get the layout orgs already had. Kept as a redirect because the old
 * path is linked from the app sidebar, the right panel, and any bookmark a
 * citizen already made.
 */
export default function LegacyCitizenDashboard() {
  redirect("/arbeitsbereich");
}
