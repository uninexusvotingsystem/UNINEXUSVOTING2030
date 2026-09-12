declare module "africastalking" {
  const AfricasTalking: (options: { apiKey: string; username: string }) => {
    SMS: {
      send: (options: { to: string[]; message: string; from?: string }) => Promise<any>;
    };
  };
  export default AfricasTalking;
}
