const file_selector = document.getElementById("file_selector");
const input_path = document.getElementById("input_path");
const file_display = document.getElementById("file_display");
const zip_name = document.getElementById("zip_name");

let files_to_zip = []; // stores files' data and names

/* Creates ZIP file data as blob from inputted file data.
Parameters:
- files (Object[]): Array of Objects that have the following properties:
	- name (string): File path and name in ZIP file
	- data (ArrayBuffer): File binary data
Return: (Blob)
  ZIP file data as a blob */
function createZIP(files) {
	/* Calculates CRC-32 for inputted data.
	Parameters:
	- data (Uint8Array): Data to use for CRC
	Return: (32-bit unsigned integer)
	  CRC-32 value */
	function calcCRC32(data) {
		let crc = 0xFFFFFFFF;
		for (let i = 0; i < data.length; i++) {
			let c = data[i];
			for (let j = 0; j < 8; j++) {
				let b = (c ^ crc) & 1;
				crc >>>= 1;
				if (b) {
					crc = crc ^ 0xEDB88320;
				}
				c >>>= 1;
			}
		}

		return ~crc >>> 0;
	}

	/* Writes a value over 4 consecutive bytes to a Uint8Array at a specified index.
	Parameters:
	- arr (Uint8Array): Array to write to
	- start_i (integer): Start index for writing to in the array
	- value (integer): Value to be written
	Preconditions:
	- The array referenced by `arr` must be indexed in the range [`start_i`, `start_i + 3`]
	Side-Effects:
	- Updates the Uint8Array referenced by `arr`
	Return: (undefined) */
	function write4B(arr, start_i, value) {
		arr[start_i] = value & 0xFF;
		arr[start_i + 1] = (value & 0xFF00) >> 8;
		arr[start_i + 2] = (value & 0xFF0000) >> 16;
		arr[start_i + 3] = (value & 0xFF000000) >>> 24;
	}

	/* Writes a value over 2 consecutive bytes to a Uint8Array at a specified index.
	Parameters:
	- arr (Uint8Array): Array to write to
	- start_i (integer): Start index for writing to in the array
	- value (integer): Value to be written
	Preconditions:
	- The array referenced by `arr` must be indexed in the range [`start_i`, `start_i + 1`]
	Side-Effects:
	- Updates the Uint8Array referenced by `arr`
	Return: (undefined) */
	function write2B(arr, start_i, value) {
		arr[start_i] = value & 0xFF;
		arr[start_i + 1] = (value & 0xFF00) >> 8;
	}

	const files_complete = files.map((file) => ({
		name: file.name,
		data: file.data,
		crc: calcCRC32(new Uint8Array(file.data)),
		is_dir: file.name[file.name.length - 1] === "/",
		local_header_offset: null
	}));

	const zip_data = [];

	let offset_count = 0;
	let central_dir_offset;

	// local files
	for (const file of files_complete) {
		const header = new ArrayBuffer(30);
		const rw_header = new Uint8Array(header);

		// local file header signature
		write4B(rw_header, 0, 0x04034B50);
		// file name length
		write2B(rw_header, 26, file.name.length);
		if (file.is_dir) {
			// version needed to extract
			rw_header[4] = 20; // 2.0
		} else {
			// version needed to extract
			rw_header[4] = 10; // 1.0
			// crc-32
			write4B(rw_header, 14, file.crc);
			// compressed size
			write4B(rw_header, 18, file.data.byteLength);
			// uncompressed size
			write4B(rw_header, 22, file.data.byteLength);
		}

		file.local_header_offset = offset_count;
		zip_data.push(header);
		offset_count += header.byteLength;
		zip_data.push(file.name);
		offset_count += file.name.length;
		zip_data.push(file.data);
		offset_count += file.data.byteLength;
	}

	central_dir_offset = offset_count;

	// central directory
	for (const file of files_complete) {
		const header = new ArrayBuffer(46);
		const rw_header = new Uint8Array(header);

		// central file header signature
		write4B(rw_header, 0, 0x02014B50)
		// version made by
		rw_header[4] = 63; // 6.3.x; I used 6.3.10
		rw_header[5] = 3; // UNIX
		// file name length
		write2B(rw_header, 28, file.name.length);
		// relative offset of local header
		write4B(rw_header, 42, file.local_header_offset);
		if (file.is_dir) {
			// version needed to extract
			rw_header[6] = 20; // 2.0
			// external file attributes
			write2B(rw_header, 40, 0o00040755); // UNIX file permissions: drwxr-xr-x
		} else {
			// version needed to extract
			rw_header[6] = 10; // 1.0
			// crc-32
			write4B(rw_header, 16, file.crc);
			// compressed size
			write4B(rw_header, 20, file.data.byteLength);
			// uncompressed size
			write4B(rw_header, 24, file.data.byteLength);
			// external file attributes
			write2B(rw_header, 40, 0o00100644); // UNIX file permissions: -rw-r--r--
		}

		zip_data.push(header);
		offset_count += header.byteLength;
		zip_data.push(file.name);
		offset_count += file.name.length;
	}

	// end of central directory record
	{
		const end_record = new ArrayBuffer(22);
		const rw_end_record = new Uint8Array(end_record);

		// end of central directory signature
		write4B(rw_end_record, 0, 0x06054B50);
		// total number of entries in the central directory on this disk
		write2B(rw_end_record, 8, files_complete.length);
		// total number of entries in the central directory
		write2B(rw_end_record, 10, files_complete.length);
		// size of the central directory
		write4B(rw_end_record, 12, offset_count - central_dir_offset);
		// offset of the start of the central directory with respect to the starting disk number
		write4B(rw_end_record, 16, central_dir_offset);

		zip_data.push(end_record);
	}

	return new Blob(zip_data);
}

/* Creates an Object that contains file name and data.
Parameters:
- n (string): File path and name in ZIP file
- d (ArrayBuffer): File binary data
Return: (Object):
  Object with the following properties:
  - name (string): File path and name in ZIP file
  - data (ArrayBuffer): File binary data */
function createFileDataObject(n, d) {
	return {
		name: n,
		data: d
	};
}

/* Updates the file display.
Globals Used:
- files_to_zip
- file_display
Side-Effects:
- Sorts `files_to_zip` by file name
- Updates `file_display` inner HTML
Return: (undefined) */
function updateFileDisplay() {
	files_to_zip.sort((a, b) => a.name.localeCompare(b.name));

	file_display.innerHTML = "";

	for (let i = 0; i < files_to_zip.length; i++) {
		const item = document.createElement("li");

		const remove_button = document.createElement("button");
		remove_button.innerText = "Remove";
		remove_button.addEventListener("click", () => {
			files_to_zip = files_to_zip.filter((element, index) => index !== i);
			updateFileDisplay();
		});

		item.append(remove_button, " " + files_to_zip[i].name);

		file_display.append(item);
	}
}

/* Formats path for file in ZIP archive.
Globals Used:
- input_path
Return: (string)
  Full path for file in ZIP archive, formatted */
function determinePath() {
	let path = input_path.value;

	if (path.length !== 0 && path[path.length - 1] !== "/") {
		path += "/";
	}
	
	return path;
}

/* Adds a new file to the files that will be put in a ZIP archive.
Globals Used:
- file_selector
- files_to_zip
Side-Effects:
- Updates `files_to_zip` with new file data
- Calls `updateFileDisplay` function
Return: (undefined) */
function addFile() {
	const file = file_selector.files[0];
	const file_reader = new FileReader();

	file_reader.onload = () => {
		const path = determinePath();

		files_to_zip.push(createFileDataObject(path + file.name, file_reader.result));

		updateFileDisplay();
	};

	if (file) {
		file_reader.readAsArrayBuffer(file);
	}
}

/* Adds a new directory to the files that will be put in a ZIP archive.
Globals Used:
- files_to_zip
Side-Effects:
- Updates `files_to_zip` with new file data
- Calls `updateFileDisplay` function
Return: (undefined) */
function addDirectory() {
	const path = determinePath();

	files_to_zip.push(createFileDataObject(path, new ArrayBuffer()));

	updateFileDisplay();
}

/* Creates a ZIP archive containing the files the user inputted and downloads it.
Globals Used:
- zip_name
Side-Effects:
- Downloads a file
Return: (undefined) */
function createZIPWithFile() {
	const data_url = URL.createObjectURL(createZIP(files_to_zip));
	let link = document.createElement("a");
	link.href = data_url;
	link.download = zip_name.value;

	link.click();
	URL.revokeObjectURL(data_url);
}
