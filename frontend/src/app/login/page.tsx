import AuthForm from "@/components/auth/AuthForm";

export const metadata = { title: "Log in · Typeform Clone" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
