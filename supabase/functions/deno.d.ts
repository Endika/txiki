declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): unknown
  env: { get(name: string): string | undefined }
}
