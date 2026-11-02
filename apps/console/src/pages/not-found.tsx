import { Compass } from "lucide-react";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="reveal mx-auto max-w-lg pt-16">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Button asChild>
            <Link to="/">Back to dashboard</Link>
          </Button>
        }
      />
    </div>
  );
}
