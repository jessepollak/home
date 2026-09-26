import { Banknote, Gift, LayoutDashboard, LifeBuoy, ScrollText, Settings, Users } from "lucide-react";

export const operatorNavigation = [
  { id: "overview", label: "Overview", href: "/admin", icon: LayoutDashboard, group: "primary" },
  { id: "customers", label: "Customers", href: "/admin/customers", icon: Users, group: "primary" },
  { id: "support", label: "Support", href: "/admin/support", icon: LifeBuoy, group: "primary" },
  { id: "growth", label: "Growth", href: "/admin/growth", icon: Gift, group: "primary" },
  { id: "money", label: "Money", href: "/admin/money", icon: Banknote, group: "primary" },
  { id: "settings", label: "Settings", href: "/admin/settings", icon: Settings, group: "secondary" },
  { id: "audit", label: "Audit log", href: "/admin/audit", icon: ScrollText, group: "secondary" },
] as const;
