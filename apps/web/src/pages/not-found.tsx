import { Compass } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/EmptyState";

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="The page you are looking for does not exist or has moved."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      }
    />
  );
}
