export const PUBLISH_MESSAGES_SCRIPT = `
for i = 2, #ARGV do
  redis.call('PUBLISH', ARGV[1], ARGV[i])
end
`;
