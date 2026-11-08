import { logout } from "./login/actions";

/** Small "Log out" button for the admin and worker headers. */
export default function LogoutButton() {
  return (
    <form action={logout}>
      <button type="submit" className="text-sm text-slate-600 underline">
        Log out
      </button>
    </form>
  );
}
