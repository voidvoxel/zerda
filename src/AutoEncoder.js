const { NeuralNetworkGPU } = require('brain.js');


const TrainingLog = require("./logs/TrainingLog");
const string2vec = require("./encoding/string2vec");
const vec2string = require("./encoding/vec2string");


/**
 * @typedef {Object} AutoEncoderTrainOptions
 * @property {number} errorThresh
 * Once the training error reaches `errorThresh`, training will be complete.
 * @property {number} iterations
 * Once the training epoch count reaches `iterations`, training will be
 * complete.
 * @property {number} learningRate
 * The rate at which values will be changed.
 */

/**
 * @typedef {import('brain.js/dist/lookup').ITrainingDatum[]} ITrainingData
 */

/**
 * @typedef {boolean[]|number[]|string} AutoDecodedData
 */

/**
 * @typedef {Float32Array} AutoEncodedData
 */

/**
 * @typedef {"boolean"|"number"|"string"} DataType
 */

/**
 * @typedef {Object} AutoEncoder
 */

/**
 * A type of neural network consisting of two subnetworks: an encoder, and a
 * decoder.
 * The encoder is responsible for converting the input into a smaller
 * representation via feature extraction.
 * The decoder is responsible for reconstructing the original input from a
 * vector of extracted features.
 *
 * Example usage:
 * ```
 * const autoEncoder = new AutoEncoder(10, 1, 'string');
 *
 * autoEncoder.train(["this", "is", "an", "example"]);
 *
 * const encoded = autoEncoder.encode("example");
 * const decoded = autoEncoder.decode(encoded);
 *
 * console.log(encoded, '->', decoded);
 * ```
 */
class AutoEncoder {
    /**
     * Parse a stringified `AutoEncoder`.
     * @param {string} jsonString
     * A JSON string containing a stringified `AutoEncoder`.
     * @returns
     */
    static parse (jsonString) {
        const json = JSON.parse(jsonString);

        const autoEncoder = new AutoEncoder(
            json.decodedDataSize,
            json.encodedDataSize,
            json.dataType
        );

        autoEncoder.fromJSON(json);

        return autoEncoder;
    }


    /**
     * Convert an `AutoEncoder` into a `string`.
     * @param {AutoEncoder} autoEncoder
     * The autoencoder to stringify.
     * @returns
     */
    static stringify (autoEncoder) {
        return autoEncoder.stringify();
    }


    /**
     * Create a new auto encoder.
     * @param {number} decodedDataSize
     * The size of the data prior to encoding, and after decoding.
     * @param {number} encodedDataSize
     * The size of the data after encoding, and prior to decoding.
     * @param {DataType} dataType
     * The type of data to encode.
     */
    constructor (
        decodedDataSize,
        encodedDataSize,
        dataType = 'number'
    ) {
        const transcodedDataSize = Math.round(
            (encodedDataSize + decodedDataSize) * 0.5
        );

        /**
         * @type {DataType}
         */
        this._dataType = dataType;

        /**
         * @type {number}
         */
        this._encodedDataSize = encodedDataSize;

        /**
         * @type {number}
         */
        this._transcodedDataSize = transcodedDataSize;

        /**
         * @type {number}
         */
        this._decodedDataSize = decodedDataSize;

        /**
         * @type {NeuralNetworkGPU}
         */
        this.encoder = new NeuralNetworkGPU(
            {
                hiddenLayers: [
                    this._getTranscodedDataSize(),
                    this._getEncodedDataSize(),
                    this._getTranscodedDataSize()
                ],
                inputSize: this._getDecodedDataSize(),
                outputSize: this._getDecodedDataSize()
            }
        );

        /**
         * @type {NeuralNetworkGPU}
         */
        this.decoder = new NeuralNetworkGPU(
            {
                hiddenLayers: [ this._getTranscodedDataSize() ],
                inputSize: this._getEncodedDataSize(),
                outputSize: this._getDecodedDataSize()
            }
        );
    }


    /**
     * Test the accuracy of the model against the given training data.
     * @param {ITrainingData} data
     * The training data to test the model against.
     * @param {boolean} strict
     * Whether or not to enable stricter-accuracy mode.
     * @returns {number}
     * The accuracy of the model against the given data.
     */
    accuracy (
        data,
        strict = true
    ) {
        if (
            !data.hasOwnProperty('length') ||
            typeof data[0] !== 'object'
        ) {
            return this._accuracy(
                data,
                strict
            );
        }

        let accuracy = 0;

        for (let input of data) {
            accuracy += this._accuracy(
                input,
                strict
            );
        }

        accuracy /= data.length;

        return accuracy;
    }


    compressionRate () {
        return 1.0 - this.compressionScale();
    }


    compressionScale () {
        return this._featureCount / this._sampleSize;
    }


    /**
     * Decode encoded data.
     * @param {Float32Array} encodedData The encoded data to decode.
     * @returns {boolean[]|number[]|string} The decoded data.
     */
    decode (encodedData) {
        let decodedDataObject = this.decoder.run(encodedData);

        let decodedData = [];

        for (let i in decodedDataObject) {
            decodedData[i] = decodedDataObject[i];

            if (this._dataType === 'boolean') {
                decodedData[i] = decodedData[i] >= 0.5;
            }
        }

        if (this._dataType === 'string') {
            decodedData = vec2string(decodedData);
            decodedData = decodedData.substring(0, decodedData.indexOf(' '));
        }

        return decodedData;
    }


    /**
     * Encode data.
     * @param {AutoDecodedData} data
     * The data to encode.
     * @returns {AutoEncodedData}
     */
    encode (data) {
        if (this._dataType === 'string') {
            if (data.length < this._getWordSize()) {
                data.padEnd(this._getWordSize());
            }

            data = string2vec(
                data,
                this._getWordSize()
            );
        }

        this.encoder.run(data);

        const encodedDataLayer = this.encoder.outputs[2];

        let encodedData = encodedDataLayer.toArray();

        return encodedData;
    }


    /**
     * Load this `AutoEncoder`'s data from JSON.
     * @param {AutoEncoderJSON} json JSON representation of an `AutoEncoder`.
     */
    fromJSON (json) {
        if (typeof json === 'string') json = JSON.parse(json);

        this._decodedDataSize = json.decodedDataSize;
        this._transcodedDataSize = json.transcodedDataSize;
        this._encodedDataSize = json.encodedDataSize;

        this.encoder.fromJSON(json.encoder);
        this.decoder.fromJSON(json.decoder);
    }


    /**
     * Predict the decoded output of a given input data.
     * @param {AutoDecodedData} input
     * The input to predict the decoded output of.
     * @returns
     */
    run (input) {
        return this.decode(this.encode(input));
    }


    /**
     * Stringify this `AutoEncoder`.
     * @returns {string}
     * A JSON `string` containing this `AutoEncoder`.
     */
    stringify () {
        return JSON.stringify(this.toJSON());
    }


    /**
     * Get this as a JSON object suitable for `JSON.stringify()`.
     * @returns {object}
     * An object suitable for `JSON.stringify()`.
     */
    toJSON () {
        return {
            encoder: this.encoder.toJSON(),
            decoder: this.decoder.toJSON()
        };
    }


    /**
     * Train the auto encoder on a training data set.
     * @param {ITrainingData} data
     * The data set to train the neural networks on.
     * @param {AutoEncoderTrainOptions} options
     * The options to pass to the neural network trainers.
     */
    async train (
        data,
        options = {}
    ) {
        const minimumAccuracy = options.accuracy ?? null;
        const attemptThreshold = options.attempts ?? null;

        delete options.accuracy;
        delete options.attempts;

        // const trainingLog = new TrainingLog();

        const cbLog = options.log;

        let attemptCount = 1;

        // options.log = (details) => trainingLog.log(details);

        if (typeof minimumAccuracy !== 'number') {
            await this._trainEncoder(data, options);
            await this._trainDecoder(data, options);
        }

        let accuracy = 0.0;

        while (
            accuracy < minimumAccuracy
                && attemptCount <= attemptThreshold
        ) {
            await this.train(
                data,
                options
            );

            accuracy = this.accuracy(data);

            let error = 1.0 - accuracy;

            let details = {
                attempts: attemptCount,
                error
            };

            if (cbLog) {
                cbLog(details);
            }

            attemptCount++;
        }

        const trainingResults = {
            accuracy,
            attempts: attemptCount
        };

        return trainingResults;
    }


    /**
     * Validate input by asserting that decoding the output of the encoder
     * reproduces the original input.
     * @param {AutoDecodedData} input
     * The input to validate.
     * @returns
     */
    validate (input) {
        const output = this.run(input);
        if (typeof output === 'string') return output === input;
        else throw new Error(`\`validate()\` not yet implemented for data type '${this._dataType}'.`);
    }


    _accuracy (
        input,
        strict = true
    ) {
        if (
            typeof input === 'object'
                && typeof input[0] === 'string'
        ) {
            return this._accuracyStringArray(input);
        }

        const encoded = this.encode(input);
        const decoded = this.decode(encoded);

        let accuracy = 0;

        if (typeof input === 'string') {
            if (strict) {
                return decoded === input ? 1 : 0;
            } else {
                for (
                    let i = 0;
                    i < decoded.length;
                    i++
                ) {
                    const inputValue = input[i];
                    const decodedValue = decoded[i];

                    const isCorrect = inputValue === decodedValue;

                    if (isCorrect) {
                        accuracy += 1;
                    }
                }

                accuracy /= decoded.length;
            }
        } else {
            for (
                let i = 0;
                i < decoded.length;
                i++
            ) {
                const inputValue = input[i];
                const decodedValue = Math.round(decoded[i]);

                const isCorrect = inputValue === decodedValue;

                if (isCorrect) {
                    accuracy += 1;
                }
            }

            accuracy /= decoded.length;
        }

        return accuracy;
    }


    _accuracyStringArray (data) {
        let accuracy = 0;

        for (let input of data) {
            let sampleAccuracy = this._accuracy(input);

            if (Number.isNaN(sampleAccuracy)) {
                sampleAccuracy = 0;
            }

            accuracy += sampleAccuracy;
        }

        accuracy /= data.length;

        return accuracy;
    }


    _getDecodedDataSize () {
        let size = this._decodedDataSize;

        if (this._dataType === 'string') {
            size *= 8;
        }

        return size;
    }


    _getEncodedDataSize () {
        let size = this._encodedDataSize;

        if (this._dataType === 'string') {
            size *= 8;
        }

        return Math.round(size);
    }


    _getTranscodedDataSize () {
        let size
            = (
                this._getEncodedDataSize()
                    + this._getDecodedDataSize()
            )
                * 0.5
        ;

        return Math.round(size);
    }


    _getVecSize () {
        return this._getWordSize() * 8;
    }


    _getWordSize () {
        return this._getDecodedDataSize() / 8;
    }


    async _trainDecoder (data, options) {
        const trainingData = [];

        for (let output of data) {
            if (this._dataType === 'string') {
                output = output.padEnd(this._getWordSize());
            }

            const rawOutput = output;

            if (typeof output === 'string') {
                output = string2vec(
                    rawOutput,
                    this._getWordSize()
                );

                this._dataType = 'string';
            }
            const input = this.encode(rawOutput);

            const entry = {
                input,
                output
            };

            trainingData.push(entry);
        }

        await this.decoder.trainAsync(trainingData, options);
    }


    async _trainEncoder (data, options) {
        const trainingData = [];

        for (let input of data) {
            if (this._dataType === 'string') {
                input = input.padEnd(this._getWordSize());
            }

            if (typeof input === 'string') {
                input = string2vec(
                    input,
                    this._getWordSize()
                );

                this._dataType = 'string';
            }

            let output = input;

            if (typeof output === 'string') {
                output = output.padEnd(this._getWordSize());

                output = string2vec(
                    output,
                    this._getWordSize()
                );

                this._dataType = 'string';
            }

            const entry = {
                input,
                output
            };

            trainingData.push(entry);
        }

        await this.encoder.trainAsync(trainingData, options);
    }
}

module.exports = AutoEncoder;
