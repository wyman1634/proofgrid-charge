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

    address public immutable owner;

    mapping(bytes32 stationId => ChargingStation) private chargingStations;
    mapping(bytes32 sessionId => ChargingSession) private chargingSessions;

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
}
