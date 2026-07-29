import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Index,
  beforeLoad: () => {
    throw redirect({
      href: "/index.html",
    });
  },
});

function Index() {
  return null;
}
