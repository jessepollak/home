export const sheetHostExceptions = [
  {
    file: "app/admin/operator-shell.tsx",
    imports: ["Drawer", "DrawerContent", "DrawerHeader", "DrawerTitle"],
    owner: "operator console",
    reason: "non-money operator navigation drawer",
  },
  {
    file: "client/account/account-screen.tsx",
    imports: ["DrawerHeader", "DrawerTitle"],
    owner: "account sign-in",
    reason: "non-money sign-in sheet on the shared AppDrawer host whose close also cancels the auth attempt",
  },
];
