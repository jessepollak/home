declare module "virtual:library-candidates" {
  const files: import("./candidates").CandidateFile[];
  export default files;
}
