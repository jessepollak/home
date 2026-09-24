// url=https://www.figma.com/design/ixgttt6IurKynsvMJpLYDC/Home?node-id=11-773
// source=apps/web/client/home/shell-chrome.tsx
// component=ShellHeader
import figma from 'figma'
const i = figma.selectedInstance
const title = i.getString('Title#11:2')
const showStatus = i.getBoolean('Show status#246:0')
export default { example: figma.code`<ShellHeader routeMode="dashboard" activeNavigation="home" nestedChromeTitle={${JSON.stringify(title)}} nestedChromeBackLabel="Back" isAccountSettingsOpen={false} isVerified={false} account={account} onNestedChromeBack={onBack} onHome={onHome} onDashboard={onDashboard} onSignIn={onSignIn} onSignOut={onSignOut} onOpenSettings={onOpenSettings} onCloseSettings={onCloseSettings}${showStatus ? figma.code` status={status}` : null} />`, imports: ['import { ShellHeader } from "@/client/home/shell-chrome"'], id: 'shell-header', metadata: { nestable: false } }
