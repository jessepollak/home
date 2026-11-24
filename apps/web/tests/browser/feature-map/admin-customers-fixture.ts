import { customerAdaDetail, customerAdaId, customerList, customerNoEmailId, customerPartialDetail } from "../fixtures/admin-customers";

export function adminCustomerFixtureRoutes(): ReadonlyArray<readonly [string, unknown]> {
  return [
    ["**/api/admin/customers", customerList],
    [`**/api/admin/customers/${customerAdaId}`, customerAdaDetail],
    [`**/api/admin/customers/${customerNoEmailId}`, customerPartialDetail],
  ];
}
