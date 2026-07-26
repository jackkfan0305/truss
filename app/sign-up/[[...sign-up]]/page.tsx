import { SignUp } from "@clerk/nextjs";

import { AuthPanel } from "@/components/auth/auth-panel";

export default function SignUpPage() {
  return (
    <AuthPanel>
      <SignUp />
    </AuthPanel>
  );
}
