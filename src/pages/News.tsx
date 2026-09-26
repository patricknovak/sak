// News & Injuries moved into the NHL centre; keep old links working.
import { Navigate } from 'react-router-dom';
export default function News() { return <Navigate to="/nhl?t=injuries" replace />; }
