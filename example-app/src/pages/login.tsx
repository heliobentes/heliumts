import { signIn } from "../libs/better-auth/auth-client";

export default function LoginPage() {
    const loginWithGoogle = async () => {
        await signIn.social({
            provider: "google",
            callbackURL: "/",
            errorCallbackURL: "/error",
            newUserCallbackURL: "/",
        });
    };

    return (
        <div>
            <h1 className="text-2xl font-bold mb-4">Login Page</h1>
            <button className="button primary" onClick={loginWithGoogle}>
                Login with Google
            </button>
        </div>
    );
}
