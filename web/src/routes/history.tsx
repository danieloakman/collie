import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import { historyPath } from "@/lib/nav";
import { useSession } from "@/lib/session";

/** Legacy `/pane/:id/history` → Chat tab on the pane detail screen. */
export function HistoryRoute() {
  const { paneId = "" } = useParams();
  const session = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(historyPath(paneId, session), { replace: true });
  }, [navigate, paneId, session]);

  return null;
}
