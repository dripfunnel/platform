// The native connection module is not in Jest: every test starts online, and a test that needs the connection to change mocks it itself.
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: () => () => undefined } }))
