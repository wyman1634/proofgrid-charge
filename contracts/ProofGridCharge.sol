// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract ProofGridCharge {
    error UnknownChargingStation();
    error InactiveChargingStation();
    error ZeroTariff();
    error ZeroEnergy();
    error InvalidDeadline();
    error IncorrectFunding(uint256 expected, uint256 actual);
    error DuplicateChargingSession();
    error SessionAlreadySettled();
    error InvalidSessionState();
    error InvalidAttestation();
    error ExpiredAttestation();
    error InvalidActualEnergy();
    error ValueTransferFailed();

    enum SessionState {
        None,
        Funded,
        Settled,
        Refunded
    }

    struct ChargingStation {
        address operator;
        address attestor;
        uint256 tariff;
        bool active;
        bool exists;
    }

    struct ChargingSession {
        address driver;
        bytes32 stationId;
        address operator;
        address attestor;
        uint256 tariff;
        uint256 maxEnergyWh;
        uint256 maximumPayment;
        uint256 deadline;
        SessionState state;
    }

    struct ChargingReceipt {
        address driver;
        bytes32 stationId;
        address operator;
        address attestor;
        uint256 tariff;
        uint256 actualEnergyWh;
        uint256 actualPayment;
        uint256 driverRefund;
        bytes32 evidenceHash;
        address relayer;
        uint256 settledAt;
    }

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CHARGING_ATTESTATION_TYPEHASH = keccak256(
        "ChargingAttestation(bytes32 sessionId,bytes32 stationId,address chargingOperator,uint256 actualEnergyWh,bytes32 evidenceHash,uint256 expiry)"
    );
    bytes32 private constant NAME_HASH = keccak256("ProofGrid Charge");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable owner;

    mapping(bytes32 stationId => ChargingStation) private chargingStations;
    mapping(bytes32 sessionId => ChargingSession) private chargingSessions;
    mapping(bytes32 sessionId => ChargingReceipt) private chargingReceipts;
    bool private settling;

    event ChargingStationConfigured(
        bytes32 indexed stationId,
        address indexed operator,
        address indexed attestor,
        uint256 tariff,
        bool active
    );
    event ChargingSessionFunded(
        bytes32 indexed sessionId,
        address indexed driver,
        bytes32 indexed stationId,
        uint256 maximumPayment
    );
    event ChargingSessionSettled(
        bytes32 indexed sessionId,
        address indexed relayer,
        uint256 actualPayment,
        uint256 driverRefund,
        bytes32 evidenceHash
    );

    constructor(address initialOwner) {
        owner = initialOwner;
    }

    function configureChargingStation(
        bytes32 stationId,
        address operator,
        address attestor,
        uint256 tariff,
        bool active
    ) external {
        require(msg.sender == owner, "Only owner");
        chargingStations[stationId] = ChargingStation({
            operator: operator,
            attestor: attestor,
            tariff: tariff,
            active: active,
            exists: true
        });
        emit ChargingStationConfigured(stationId, operator, attestor, tariff, active);
    }

    function createChargingSession(
        bytes32 sessionId,
        bytes32 stationId,
        uint256 maxEnergyWh,
        uint256 deadline
    ) external payable {
        if (chargingSessions[sessionId].state != SessionState.None) revert DuplicateChargingSession();
        ChargingStation memory station = chargingStations[stationId];
        if (!station.exists) revert UnknownChargingStation();
        if (!station.active) revert InactiveChargingStation();
        if (station.tariff == 0) revert ZeroTariff();
        if (maxEnergyWh == 0) revert ZeroEnergy();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        uint256 maximumPayment = station.tariff * maxEnergyWh;
        if (msg.value != maximumPayment) revert IncorrectFunding(maximumPayment, msg.value);

        chargingSessions[sessionId] = ChargingSession({
            driver: msg.sender,
            stationId: stationId,
            operator: station.operator,
            attestor: station.attestor,
            tariff: station.tariff,
            maxEnergyWh: maxEnergyWh,
            maximumPayment: maximumPayment,
            deadline: deadline,
            state: SessionState.Funded
        });

        emit ChargingSessionFunded(sessionId, msg.sender, stationId, maximumPayment);
    }

    function getChargingStation(bytes32 stationId)
        external
        view
        returns (address operator, address attestor, uint256 tariff, bool active)
    {
        ChargingStation memory station = chargingStations[stationId];
        if (!station.exists) revert UnknownChargingStation();
        return (station.operator, station.attestor, station.tariff, station.active);
    }

    function getChargingSession(bytes32 sessionId)
        external
        view
        returns (
            address driver,
            bytes32 stationId,
            address operator,
            address attestor,
            uint256 tariff,
            uint256 maxEnergyWh,
            uint256 maximumPayment,
            uint256 deadline,
            SessionState state
        )
    {
        ChargingSession memory session = chargingSessions[sessionId];
        return (
            session.driver,
            session.stationId,
            session.operator,
            session.attestor,
            session.tariff,
            session.maxEnergyWh,
            session.maximumPayment,
            session.deadline,
            session.state
        );
    }

    function settleChargingSession(
        bytes32 sessionId,
        uint256 actualEnergyWh,
        bytes32 evidenceHash,
        uint256 expiry,
        bytes calldata signature
    ) external {
        ChargingSession storage session = chargingSessions[sessionId];
        if (session.state == SessionState.Settled) revert SessionAlreadySettled();
        if (settling) revert InvalidSessionState();
        if (session.state != SessionState.Funded) revert InvalidSessionState();
        if (expiry <= block.timestamp) revert ExpiredAttestation();
        {
            bytes32 structHash = keccak256(
                abi.encode(
                    CHARGING_ATTESTATION_TYPEHASH,
                    sessionId,
                    session.stationId,
                    session.operator,
                    actualEnergyWh,
                    evidenceHash,
                    expiry
                )
            );
            bytes32 domainSeparator = keccak256(
                abi.encode(EIP712_DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
            );
            bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
            if (_recoverSigner(digest, signature) != session.attestor) revert InvalidAttestation();
        }

        if (actualEnergyWh == 0 || actualEnergyWh > session.maxEnergyWh) revert InvalidActualEnergy();
        uint256 actualPayment = session.tariff * actualEnergyWh;
        uint256 driverRefund = session.maximumPayment - actualPayment;

        settling = true;
        session.state = SessionState.Settled;
        chargingReceipts[sessionId] = ChargingReceipt({
            driver: session.driver,
            stationId: session.stationId,
            operator: session.operator,
            attestor: session.attestor,
            tariff: session.tariff,
            actualEnergyWh: actualEnergyWh,
            actualPayment: actualPayment,
            driverRefund: driverRefund,
            evidenceHash: evidenceHash,
            relayer: msg.sender,
            settledAt: block.timestamp
        });

        (bool operatorPaid,) = session.operator.call{value: actualPayment}("");
        if (!operatorPaid) revert ValueTransferFailed();
        (bool driverRefunded,) = session.driver.call{value: driverRefund}("");
        if (!driverRefunded) revert ValueTransferFailed();
        settling = false;

        emit ChargingSessionSettled(sessionId, msg.sender, actualPayment, driverRefund, evidenceHash);
    }

    function getChargingReceipt(bytes32 sessionId)
        external
        view
        returns (
            address driver,
            bytes32 stationId,
            address operator,
            address attestor,
            uint256 tariff,
            uint256 actualEnergyWh,
            uint256 actualPayment,
            uint256 driverRefund,
            bytes32 evidenceHash,
            address relayer,
            uint256 settledAt
        )
    {
        ChargingReceipt memory receipt = chargingReceipts[sessionId];
        return (
            receipt.driver,
            receipt.stationId,
            receipt.operator,
            receipt.attestor,
            receipt.tariff,
            receipt.actualEnergyWh,
            receipt.actualPayment,
            receipt.driverRefund,
            receipt.evidenceHash,
            receipt.relayer,
            receipt.settledAt
        );
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
